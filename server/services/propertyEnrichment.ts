import { dataSourceBroker, type LookupCategory } from "./data-source-broker";
import { storage } from "../storage";
import type { Property, Lead } from "@shared/schema";

export interface EnrichmentResult {
  propertyId?: number;
  leadId?: number;
  latitude: number;
  longitude: number;
  enrichedAt: Date;
  lookupTimeMs: number;
  
  parcel?: {
    apn?: string;
    owner?: string;
    address?: string;
    acreage?: number;
    legalDescription?: string;
    assessedValue?: number;
    taxAmount?: number;
    source?: string;
  };
  
  hazards?: {
    floodZone?: string;
    floodRisk?: "low" | "medium" | "high";
    wetlandsPresent?: boolean;
    wetlandsPercentage?: number;
    earthquakeRisk?: "low" | "medium" | "high";
    wildfireRisk?: "low" | "medium" | "high";
    nearbySuperfundSites?: number;
    overallRiskScore?: number;
    overallRiskLevel?: "low" | "medium" | "high";
  };
  
  environment?: {
    soilType?: string;
    soilSuitability?: string;
    epaFacilitiesNearby?: number;
    epaRiskLevel?: "low" | "medium" | "high";
  };
  
  infrastructure?: {
    nearestHospitalMiles?: number;
    nearestFireStationMiles?: number;
    nearestSchoolMiles?: number;
    nearestAirportMiles?: number;
    nearbyHospitals?: number;
    nearbyFireStations?: number;
    nearbySchools?: number;
    accessScore?: number;
  };
  
  demographics?: {
    population?: number;
    medianIncome?: number;
    medianHomeValue?: number;
    povertyRate?: number;
    collegeEducated?: number;
  };
  
  publicLands?: {
    nearBLM?: boolean;
    nearUSFS?: boolean;
    nearNPS?: boolean;
    federalLandWithinMiles?: number;
  };
  
  transportation?: {
    nearestHighwayMiles?: number;
    nearestBridgeMiles?: number;
    nearestRailMiles?: number;
    roadAccessScore?: number;
  };
  
  water?: {
    nearestStreamMiles?: number;
    nearestWaterBodyMiles?: number;
    waterAvailabilityScore?: number;
  };
  
  scores?: {
    investmentScore?: number;
    developmentScore?: number;
    riskScore?: number;
    overallScore?: number;
  };
  
  errors?: Record<string, string>;
}

export class PropertyEnrichmentService {
  async enrichByCoordinates(
    latitude: number,
    longitude: number,
    options?: {
      categories?: LookupCategory[];
      state?: string;
      county?: string;
      apn?: string;
      propertyId?: number;
      leadId?: number;
      forceRefresh?: boolean;
    }
  ): Promise<EnrichmentResult> {
    const startTime = Date.now();
    const errors: Record<string, string> = {};
    
    const defaultCategories: LookupCategory[] = [
      "flood_zone",
      "wetlands", 
      "soil",
      "environmental",
      "infrastructure",
      "natural_hazards",
      "demographics",
      "public_lands",
      "transportation",
      "water_resources"
    ];
    
    const categories = options?.categories || defaultCategories;
    
    const multiResult = await dataSourceBroker.lookupMultiple(categories, {
      latitude,
      longitude,
      state: options?.state,
      county: options?.county,
      apn: options?.apn,
      forceRefresh: options?.forceRefresh,
    });
    
    const result: EnrichmentResult = {
      propertyId: options?.propertyId,
      leadId: options?.leadId,
      latitude,
      longitude,
      enrichedAt: new Date(),
      lookupTimeMs: multiResult.totalLookupTimeMs,
    };
    
    for (const [category, lookupResult] of Object.entries(multiResult.results)) {
      if (!lookupResult.success) {
        errors[category] = lookupResult.fallbacksUsed.join("; ") || "Lookup failed";
        continue;
      }
      
      const data = lookupResult.data;
      
      switch (category) {
        case "flood_zone":
          result.hazards = result.hazards || {};
          result.hazards.floodZone = data.zone;
          result.hazards.floodRisk = data.riskLevel;
          break;
          
        case "wetlands":
          result.hazards = result.hazards || {};
          result.hazards.wetlandsPresent = data.hasWetlands;
          result.hazards.wetlandsPercentage = data.percentage;
          break;
          
        case "soil":
          result.environment = result.environment || {};
          result.environment.soilType = data.soilType;
          result.environment.soilSuitability = data.suitability;
          break;
          
        case "environmental":
          result.environment = result.environment || {};
          result.environment.epaFacilitiesNearby = data.superfundSites?.length || 0;
          result.environment.epaRiskLevel = data.riskLevel;
          break;
          
        case "infrastructure":
          result.infrastructure = result.infrastructure || {};
          if (data.hospitals) {
            result.infrastructure.nearbyHospitals = data.hospitals.count;
            result.infrastructure.nearestHospitalMiles = data.hospitals.nearestMiles;
          }
          if (data.fireStations) {
            result.infrastructure.nearbyFireStations = data.fireStations.count;
            result.infrastructure.nearestFireStationMiles = data.fireStations.nearestMiles;
          }
          if (data.schools) {
            result.infrastructure.nearbySchools = data.schools.count;
            result.infrastructure.nearestSchoolMiles = data.schools.nearestMiles;
          }
          result.infrastructure.accessScore = this.calculateAccessScore(result.infrastructure);
          break;
          
        case "natural_hazards":
          result.hazards = result.hazards || {};
          if (data.earthquake) {
            result.hazards.earthquakeRisk = data.earthquake.riskLevel;
          }
          if (data.wildfire) {
            result.hazards.wildfireRisk = data.wildfire.riskLevel;
          }
          break;
          
        case "demographics":
          result.demographics = result.demographics || {};
          result.demographics.population = data.population;
          result.demographics.medianIncome = data.medianIncome;
          result.demographics.medianHomeValue = data.medianHomeValue;
          result.demographics.povertyRate = data.povertyRate;
          break;
          
        case "public_lands":
          result.publicLands = result.publicLands || {};
          result.publicLands.nearBLM = data.blm?.count > 0;
          result.publicLands.nearUSFS = data.usfs?.count > 0;
          result.publicLands.nearNPS = data.nps?.count > 0;
          break;
          
        case "transportation":
          result.transportation = result.transportation || {};
          if (data.highways) {
            result.transportation.nearestHighwayMiles = data.highways.nearestMiles;
          }
          if (data.bridges) {
            result.transportation.nearestBridgeMiles = data.bridges.nearestMiles;
          }
          if (data.railroads) {
            result.transportation.nearestRailMiles = data.railroads.nearestMiles;
          }
          result.transportation.roadAccessScore = this.calculateRoadScore(result.transportation);
          break;
          
        case "water_resources":
          result.water = result.water || {};
          if (data.streams) {
            result.water.nearestStreamMiles = data.streams.nearestMiles;
          }
          if (data.waterBodies) {
            result.water.nearestWaterBodyMiles = data.waterBodies.nearestMiles;
          }
          break;
      }
    }
    
    this.calculateScores(result);
    
    if (Object.keys(errors).length > 0) {
      result.errors = errors;
    }
    
    return result;
  }
  
  async enrichProperty(organizationId: number, propertyId: number, forceRefresh = false): Promise<EnrichmentResult> {
    const property = await storage.getProperty(organizationId, propertyId);
    if (!property) {
      throw new Error("Property not found");
    }
    
    const lat = property.latitude ? parseFloat(property.latitude) : null;
    const lng = property.longitude ? parseFloat(property.longitude) : null;
    
    if (!lat || !lng) {
      throw new Error("Property missing coordinates");
    }
    
    const result = await this.enrichByCoordinates(lat, lng, {
      propertyId,
      state: property.state || undefined,
      county: property.county || undefined,
      apn: property.apn || undefined,
      forceRefresh,
    });
    
    await this.savePropertyEnrichment(organizationId, propertyId, result);
    
    return result;
  }
  
  async enrichLead(organizationId: number, leadId: number, coordinates?: { latitude: number; longitude: number }, forceRefresh = false): Promise<EnrichmentResult | null> {
    const lead = await storage.getLead(organizationId, leadId);
    if (!lead) {
      throw new Error("Lead not found");
    }
    
    let lat: number | null = null;
    let lng: number | null = null;
    
    if (coordinates) {
      lat = coordinates.latitude;
      lng = coordinates.longitude;
    } else {
      return null;
    }
    
    const result = await this.enrichByCoordinates(lat, lng, {
      leadId,
      state: lead.state || undefined,
      forceRefresh,
    });
    
    await this.saveLeadEnrichment(leadId, result);
    
    return result;
  }
  
  private calculateAccessScore(infrastructure: EnrichmentResult["infrastructure"]): number {
    if (!infrastructure) return 50;
    
    let score = 50;
    
    const hospitalDist = infrastructure.nearestHospitalMiles || 100;
    if (hospitalDist < 5) score += 15;
    else if (hospitalDist < 15) score += 10;
    else if (hospitalDist < 30) score += 5;
    else if (hospitalDist > 50) score -= 10;
    
    const fireDist = infrastructure.nearestFireStationMiles || 100;
    if (fireDist < 5) score += 15;
    else if (fireDist < 10) score += 10;
    else if (fireDist < 20) score += 5;
    else if (fireDist > 40) score -= 10;
    
    const schoolDist = infrastructure.nearestSchoolMiles || 100;
    if (schoolDist < 5) score += 10;
    else if (schoolDist < 15) score += 5;
    else if (schoolDist > 40) score -= 5;
    
    return Math.max(0, Math.min(100, score));
  }
  
  private calculateRoadScore(transportation: EnrichmentResult["transportation"]): number {
    if (!transportation) return 50;
    
    let score = 50;
    
    const hwDist = transportation.nearestHighwayMiles || 100;
    if (hwDist < 5) score += 20;
    else if (hwDist < 15) score += 15;
    else if (hwDist < 30) score += 10;
    else if (hwDist > 60) score -= 15;
    
    return Math.max(0, Math.min(100, score));
  }
  
  private calculateScores(result: EnrichmentResult): void {
    let riskScore = 0;
    let developmentScore = 50;
    let investmentScore = 50;
    
    if (result.hazards) {
      if (result.hazards.floodRisk === "high") riskScore += 30;
      else if (result.hazards.floodRisk === "medium") riskScore += 15;
      
      if (result.hazards.wetlandsPresent) riskScore += 20;
      
      if (result.hazards.earthquakeRisk === "high") riskScore += 20;
      else if (result.hazards.earthquakeRisk === "medium") riskScore += 10;
      
      if (result.hazards.wildfireRisk === "high") riskScore += 25;
      else if (result.hazards.wildfireRisk === "medium") riskScore += 12;
      
      result.hazards.overallRiskScore = Math.min(100, riskScore);
      result.hazards.overallRiskLevel = riskScore > 50 ? "high" : riskScore > 25 ? "medium" : "low";
    }
    
    if (result.infrastructure?.accessScore) {
      developmentScore = (developmentScore + result.infrastructure.accessScore) / 2;
    }
    
    if (result.transportation?.roadAccessScore) {
      developmentScore = (developmentScore + result.transportation.roadAccessScore) / 2;
    }
    
    if (result.demographics?.medianIncome) {
      if (result.demographics.medianIncome > 75000) investmentScore += 15;
      else if (result.demographics.medianIncome > 50000) investmentScore += 10;
      else if (result.demographics.medianIncome < 30000) investmentScore -= 10;
    }
    
    investmentScore = investmentScore - (riskScore * 0.3) + (developmentScore * 0.2);
    
    result.scores = {
      riskScore: Math.round(riskScore),
      developmentScore: Math.round(developmentScore),
      investmentScore: Math.round(Math.max(0, Math.min(100, investmentScore))),
      overallScore: Math.round((investmentScore + developmentScore - riskScore * 0.5) / 2),
    };
  }
  
  private async savePropertyEnrichment(organizationId: number, propertyId: number, enrichment: EnrichmentResult): Promise<void> {
    try {
      await storage.updateProperty(propertyId, {
        dueDiligenceData: {
          ...enrichment,
          lastEnrichedAt: new Date().toISOString(),
        } as any,
      });
      
      const categoriesEnriched = Object.keys(enrichment).filter(
        k => enrichment[k as keyof EnrichmentResult] !== undefined && 
             !['propertyId', 'latitude', 'longitude', 'enrichedAt', 'lookupTimeMs'].includes(k)
      );
      console.log(`[PropertyEnrichment] Property enrichment persisted for propertyId=${propertyId}, orgId=${organizationId}, categories: ${categoriesEnriched.join(', ')}`);
    } catch (error) {
      console.error("Failed to save property enrichment:", error);
    }
  }
  
  private async saveLeadEnrichment(leadId: number, enrichment: EnrichmentResult): Promise<void> {
    try {
      const allLeads = await storage.getLeads(undefined);
      const lead = allLeads.find(l => l.id === leadId);
      
      let existingScoreFactors: Record<string, any> = {};
      if (lead?.scoreFactors && typeof lead.scoreFactors === 'object') {
        existingScoreFactors = lead.scoreFactors as Record<string, any>;
      }
      
      const mergedScoreFactors = {
        ...existingScoreFactors,
        gisEnrichment: enrichment,
        lastEnrichedAt: new Date().toISOString(),
      };
      
      await storage.updateLead(leadId, {
        scoreFactors: mergedScoreFactors as any,
      });
      
      const categoriesEnriched = Object.keys(enrichment).filter(
        k => enrichment[k as keyof EnrichmentResult] !== undefined && 
             !['leadId', 'latitude', 'longitude', 'enrichedAt', 'lookupTimeMs'].includes(k)
      );
      console.log(`[PropertyEnrichment] Lead enrichment persisted for leadId=${leadId}, categories: ${categoriesEnriched.join(', ')}`);
    } catch (error) {
      console.error("Failed to save lead enrichment:", error);
    }
  }
}

export const propertyEnrichmentService = new PropertyEnrichmentService();
