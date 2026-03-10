/**
 * Lead Scoring Service - Betty-style lead scoring for land investors
 * 
 * Uses public data enrichment and configurable weights to score leads
 * based on likelihood to sell at a discount.
 * 
 * Score range: -400 to +400 (similar to Betty)
 * Recommendations:
 *   >= 100: "mail" - High priority target
 *   0 to 99: "maybe" - Consider with budget
 *   < 0: "skip" - Low probability
 */

import { db } from "../db";
import { 
  leads, 
  leadScoringProfiles, 
  leadScoreHistory, 
  leadConversions,
  properties,
  campaigns,
  leadActivities,
  type Lead,
  type LeadScoringProfile,
  type LeadScoreHistory
} from "@shared/schema";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import { DataSourceBroker } from "./data-source-broker";

interface ScoreFactorResult {
  value: number | boolean | string;
  score: number;
  weight: number;
  explanation: string;
  rawData?: any;
}

interface ScoringResult {
  leadId: number;
  score: number;
  normalizedScore: number;
  recommendation: "mail" | "maybe" | "skip";
  factors: Record<string, ScoreFactorResult>;
  enrichmentData: any;
  scoredAt: Date;
}

interface EnrichmentData {
  parcelData?: any;
  floodData?: any;
  censusData?: any;
  taxData?: any;
  marketData?: any;
  ownerData?: any;
}

const dataSourceBroker = new DataSourceBroker();

export class LeadScoringService {
  
  async getOrCreateDefaultProfile(organizationId: number): Promise<LeadScoringProfile> {
    const existing = await db.select().from(leadScoringProfiles)
      .where(and(
        eq(leadScoringProfiles.organizationId, organizationId),
        eq(leadScoringProfiles.isActive, true)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0];
    }
    
    const [profile] = await db.insert(leadScoringProfiles)
      .values({
        organizationId,
        name: "Default",
        isActive: true,
      })
      .returning();
    
    return profile;
  }

  async scoreLead(leadId: number, organizationId: number, triggerSource: string = "manual"): Promise<ScoringResult> {
    const [lead] = await db.select().from(leads)
      .where(and(
        eq(leads.id, leadId),
        eq(leads.organizationId, organizationId)
      ));
    
    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }
    
    const profile = await this.getOrCreateDefaultProfile(organizationId);
    const enrichmentData = await this.enrichLead(lead);
    const factors = await this.calculateFactors(lead, profile, enrichmentData);
    
    let totalScore = 0;
    for (const factor of Object.values(factors)) {
      totalScore += factor.score;
    }
    
    const normalizedScore = Math.max(-400, Math.min(400, Math.round(totalScore)));
    
    let recommendation: "mail" | "maybe" | "skip";
    if (normalizedScore >= 100) {
      recommendation = "mail";
    } else if (normalizedScore >= 0) {
      recommendation = "maybe";
    } else {
      recommendation = "skip";
    }
    
    const previousHistory = await db.select().from(leadScoreHistory)
      .where(eq(leadScoreHistory.leadId, leadId))
      .orderBy(desc(leadScoreHistory.scoredAt))
      .limit(1);
    
    const previousScore = previousHistory.length > 0 ? previousHistory[0].score : null;
    
    await db.insert(leadScoreHistory).values({
      leadId,
      organizationId,
      profileId: profile.id,
      score: normalizedScore,
      previousScore,
      factors: {
        ...this.formatFactorsForStorage(factors),
        totalRawScore: totalScore,
        normalizedScore,
        recommendation,
      },
      enrichmentData: {
        ...enrichmentData,
        lastEnriched: new Date().toISOString(),
      },
      triggerSource,
    });
    
    await db.update(leads)
      .set({
        score: Math.round((normalizedScore + 400) / 8),
        lastScoreAt: new Date(),
        nurturingStage: recommendation === "mail" ? "hot" : recommendation === "maybe" ? "warm" : "cold",
      })
      .where(eq(leads.id, leadId));
    
    return {
      leadId,
      score: normalizedScore,
      normalizedScore,
      recommendation,
      factors,
      enrichmentData,
      scoredAt: new Date(),
    };
  }

  async batchScoreLeads(
    leadIds: number[], 
    organizationId: number, 
    triggerSource: string = "batch"
  ): Promise<ScoringResult[]> {
    const results: ScoringResult[] = [];
    
    for (const leadId of leadIds) {
      try {
        const result = await this.scoreLead(leadId, organizationId, triggerSource);
        results.push(result);
      } catch (error: any) {
        console.error(`[LeadScoring] Failed to score lead ${leadId}:`, error.message);
      }
    }
    
    return results;
  }

  private async enrichLead(lead: Lead): Promise<EnrichmentData> {
    const enrichmentData: EnrichmentData = {};
    
    if (lead.address && lead.state) {
      const coords = await this.geocodeAddress(lead.address, lead.city, lead.state, lead.zip);
      
      if (coords) {
        try {
          const parcelResult = await dataSourceBroker.lookup("parcel_data", {
            latitude: coords.lat,
            longitude: coords.lng,
            state: lead.state,
            address: lead.address,
          });
          if (parcelResult.success) {
            enrichmentData.parcelData = parcelResult.data;
          }
        } catch (e) {
          console.log("[LeadScoring] Parcel lookup failed:", e);
        }
        
        try {
          const floodResult = await dataSourceBroker.lookup("flood_zone", {
            latitude: coords.lat,
            longitude: coords.lng,
            state: lead.state,
          });
          if (floodResult.success) {
            enrichmentData.floodData = floodResult.data;
          }
        } catch (e) {
          console.log("[LeadScoring] Flood lookup failed:", e);
        }
      }
    }
    
    return enrichmentData;
  }

  private async geocodeAddress(
    address: string | null, 
    city: string | null, 
    state: string | null, 
    zip: string | null
  ): Promise<{ lat: number; lng: number } | null> {
    if (!address || !state) return null;
    
    return null;
  }

  private async calculateFactors(
    lead: Lead,
    profile: LeadScoringProfile,
    enrichment: EnrichmentData
  ): Promise<Record<string, ScoreFactorResult>> {
    const factors: Record<string, ScoreFactorResult> = {};

    // Original signals
    factors.ownershipDuration = await this.calcOwnershipDuration(lead, enrichment, profile.ownershipDurationWeight || 15);
    factors.taxDelinquency = await this.calcTaxDelinquency(lead, enrichment, profile.taxDelinquencyWeight || 20);
    factors.absenteeOwner = await this.calcAbsenteeOwner(lead, enrichment, profile.absenteeOwnerWeight || 15);
    factors.propertySize = await this.calcPropertySize(lead, enrichment, profile.propertySizeWeight || 10);
    factors.corporateOwner = await this.calcCorporateOwner(lead, profile.corporateOwnerWeight || 10);
    factors.outOfState = await this.calcOutOfState(lead, enrichment, profile.outOfStateWeight || 15);
    factors.inheritanceIndicator = await this.calcInheritanceIndicator(lead, profile.inheritanceIndicatorWeight || 15);
    factors.floodZone = await this.calcFloodZone(enrichment, profile.floodZoneWeight || 10);
    factors.responseRecency = await this.calcResponseRecency(lead, profile.responseRecencyWeight || 25);
    factors.emailEngagement = await this.calcEmailEngagement(lead, profile.emailEngagementWeight || 15);
    factors.campaignTouches = await this.calcCampaignTouches(lead, profile.campaignTouchesWeight || 10);

    // Epic C: 15 new AcreScore Pro signals
    factors.distanceOwnerToProperty = await this.calcDistanceOwnerToProperty(lead, enrichment);
    factors.ownerAgeSignal = await this.calcOwnerAgeSignal(lead, enrichment);
    factors.blmAdjacency = await this.calcBLMAdjacency(enrichment);
    factors.wildfireRiskPenalty = await this.calcWildfireRiskPenalty(enrichment);
    factors.disasterHistoryPenalty = await this.calcDisasterHistoryPenalty(lead, enrichment);
    factors.endangeredSpeciesPenalty = await this.calcEndangeredSpeciesPenalty(enrichment);
    factors.multipleLiens = await this.calcMultipleLiens(lead, enrichment);
    factors.noStructure = await this.calcNoStructure(lead, enrichment);
    factors.daysOnMarket = await this.calcDaysOnMarket(lead, enrichment);
    factors.priceReduction = await this.calcPriceReduction(lead, enrichment);
    factors.countyAbsorption = await this.calcCountyAbsorption(lead, enrichment);
    factors.outOfStateTaxDelinquent = await this.calcOutOfStateTaxDelinquentCombo(lead, enrichment);
    factors.forestLandCover = await this.calcForestLandCover(enrichment);
    factors.lowDevelopmentEncroachment = await this.calcLowDevelopmentEncroachment(enrichment);
    factors.soilNccpi = await this.calcSoilNccpi(enrichment);

    return factors;
  }

  // ============================================
  // EPIC C: 15 NEW ACRESCORE PRO SIGNALS
  // ============================================

  private async calcDistanceOwnerToProperty(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const ownerState = lead.state;
    const propState = enrichment.parcelData?.propertyState || enrichment.parcelData?.state;
    const isDifferentState = ownerState && propState && ownerState.toUpperCase() !== propState.toUpperCase();
    const score = isDifferentState ? 150 : 0;
    return { value: isDifferentState ? ">100 miles (different state)" : "local", score, weight: 150, explanation: isDifferentState ? "Owner in different state from property — strong absentee signal (+150)" : "Owner is local", rawData: { ownerState, propState } };
  }

  private async calcOwnerAgeSignal(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const ownerAge = enrichment.parcelData?.ownerAge || enrichment.ownerData?.age || 0;
    const score = ownerAge > 75 ? 75 : ownerAge > 65 ? 40 : 0;
    return { value: ownerAge, score, weight: 75, explanation: ownerAge > 75 ? "Owner age >75 — estate/probate probability elevated (+75)" : ownerAge > 65 ? "Owner age >65 — approaching estate territory (+40)" : "Owner age unknown or below threshold", rawData: { ownerAge } };
  }

  private async calcBLMAdjacency(enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const adjacent = enrichment.parcelData?.blmAdjacent || enrichment.parcelData?.publicLandAdjacent || false;
    const score = adjacent ? 75 : 0;
    return { value: adjacent, score, weight: 75, explanation: adjacent ? "Adjacent to BLM/National Forest — recreational premium (+75)" : "No public land adjacency detected", rawData: { adjacent } };
  }

  private async calcWildfireRiskPenalty(enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const risk = enrichment.parcelData?.wildfireRisk || "unknown";
    const score = risk === "very_high" ? -50 : risk === "high" ? -25 : 0;
    return { value: risk, score, weight: 50, explanation: score < 0 ? `High wildfire risk (${risk}) — buyer pool and insurability reduced (${score})` : "Low/acceptable wildfire risk", rawData: { risk } };
  }

  private async calcDisasterHistoryPenalty(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const disasters = enrichment.parcelData?.disasterCount10yr || enrichment.parcelData?.femaDeclarations || 0;
    const score = disasters > 5 ? -75 : disasters > 3 ? -40 : 0;
    return { value: disasters, score, weight: 75, explanation: disasters > 5 ? `${disasters} FEMA disaster declarations in 10yr — high risk county (-75)` : disasters > 0 ? `${disasters} disaster declarations — moderate risk` : "No significant disaster history", rawData: { disasters } };
  }

  private async calcEndangeredSpeciesPenalty(enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const hasSpecies = enrichment.parcelData?.endangeredSpecies || enrichment.floodData?.endangeredSpecies || false;
    const score = hasSpecies ? -100 : 0;
    return { value: hasSpecies, score, weight: 100, explanation: hasSpecies ? "Endangered species present — development severely limited (-100)" : "No listed endangered species detected", rawData: { hasSpecies } };
  }

  private async calcMultipleLiens(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const lienCount = enrichment.parcelData?.lienCount || enrichment.taxData?.lienCount || 0;
    const score = lienCount >= 2 ? 100 : lienCount === 1 ? 50 : 0;
    return { value: lienCount, score, weight: 100, explanation: lienCount >= 2 ? `${lienCount} liens on property — motivated seller signal (+100)` : lienCount === 1 ? "1 lien — some motivation (+50)" : "No liens detected", rawData: { lienCount } };
  }

  private async calcNoStructure(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const hasStructure = enrichment.parcelData?.hasStructure || enrichment.parcelData?.improvementValue > 0 || false;
    const score = !hasStructure ? 50 : 0;
    return { value: !hasStructure, score, weight: 50, explanation: !hasStructure ? "No structure on parcel — raw land, ideal for land investing model (+50)" : "Structure present — not raw land", rawData: { hasStructure } };
  }

  private async calcDaysOnMarket(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const dom = enrichment.marketData?.daysOnMarket || enrichment.parcelData?.daysOnMarket || 0;
    const score = dom > 180 ? 100 : dom > 90 ? 50 : 0;
    return { value: dom, score, weight: 100, explanation: dom > 180 ? `Listed ${dom} days — stale listing, motivated seller (+100)` : dom > 90 ? `Listed ${dom} days — aging listing (+50)` : dom > 0 ? `Listed ${dom} days` : "DOM unknown", rawData: { dom } };
  }

  private async calcPriceReduction(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const hasPriceReduction = enrichment.marketData?.priceReduced || enrichment.parcelData?.priceReduced || false;
    const score = hasPriceReduction ? 75 : 0;
    return { value: hasPriceReduction, score, weight: 75, explanation: hasPriceReduction ? "Price reduced — seller is motivated, willing to negotiate (+75)" : "No price reduction history", rawData: { hasPriceReduction } };
  }

  private async calcCountyAbsorption(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const absorptionMonths = enrichment.marketData?.monthsOfSupply || enrichment.parcelData?.absorptionRate || 0;
    const score = absorptionMonths < 3 && absorptionMonths > 0 ? 50 : 0;
    return { value: absorptionMonths, score, weight: 50, explanation: absorptionMonths < 3 && absorptionMonths > 0 ? `County absorption rate ${absorptionMonths} months — fast-moving market (+50)` : `County absorption: ${absorptionMonths} months`, rawData: { absorptionMonths } };
  }

  private async calcOutOfStateTaxDelinquentCombo(lead: Lead, enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const ownerState = lead.state;
    const propState = enrichment.parcelData?.propertyState;
    const isOutOfState = ownerState && propState && ownerState.toUpperCase() !== propState.toUpperCase();
    const isDelinquent = enrichment.taxData?.delinquent || enrichment.parcelData?.taxDelinquent || false;
    const score = isOutOfState && isDelinquent ? 200 : 0;
    return { value: isOutOfState && isDelinquent, score, weight: 200, explanation: isOutOfState && isDelinquent ? "COMBO: Out-of-state + tax delinquent — highest motivation signal (+200)" : "Out-of-state + tax delinquent combo not present", rawData: { isOutOfState, isDelinquent } };
  }

  private async calcForestLandCover(enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const forestPct = enrichment.parcelData?.forestPercent || 0;
    const score = forestPct > 80 ? 50 : forestPct > 60 ? 25 : 0;
    return { value: forestPct, score, weight: 50, explanation: forestPct > 80 ? `${forestPct}% forest cover — high recreational premium (+50)` : forestPct > 60 ? `${forestPct}% forest cover — recreational signal (+25)` : `${forestPct}% forest cover`, rawData: { forestPct } };
  }

  private async calcLowDevelopmentEncroachment(enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const devPct = enrichment.parcelData?.developedPercent || 0;
    const score = devPct < 5 && devPct >= 0 ? 25 : 0;
    return { value: devPct, score, weight: 25, explanation: devPct < 5 ? `Only ${devPct}% developed land nearby — pristine rural character (+25)` : `${devPct}% developed nearby — some encroachment`, rawData: { devPct } };
  }

  private async calcSoilNccpi(enrichment: EnrichmentData): Promise<ScoreFactorResult> {
    const nccpi = enrichment.parcelData?.nccpiScore || 0;
    const score = nccpi > 0.6 ? 100 : nccpi > 0.4 ? 50 : 0;
    return { value: nccpi, score, weight: 100, explanation: nccpi > 0.6 ? `NCCPI soil score ${nccpi.toFixed(2)} — prime agricultural productivity (+100)` : nccpi > 0 ? `NCCPI soil score ${nccpi.toFixed(2)}` : "NCCPI soil score unavailable", rawData: { nccpi } };
  }

  private async calcOwnershipDuration(lead: Lead, enrichment: EnrichmentData, weight: number): Promise<ScoreFactorResult> {
    let yearsOwned = 0;
    let scoreMultiplier = 0;
    
    if (enrichment.parcelData?.lastSaleDate) {
      const lastSale = new Date(enrichment.parcelData.lastSaleDate);
      const now = new Date();
      yearsOwned = (now.getTime() - lastSale.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      
      if (yearsOwned >= 15) scoreMultiplier = 1.0;
      else if (yearsOwned >= 10) scoreMultiplier = 0.8;
      else if (yearsOwned >= 7) scoreMultiplier = 0.6;
      else if (yearsOwned >= 5) scoreMultiplier = 0.4;
      else if (yearsOwned >= 3) scoreMultiplier = 0.2;
      else scoreMultiplier = 0;
    }
    
    return {
      value: yearsOwned,
      score: Math.round(weight * scoreMultiplier * 4),
      weight,
      explanation: yearsOwned > 0 
        ? `Property owned for ${Math.round(yearsOwned)} years` 
        : "Ownership duration unknown",
      rawData: { yearsOwned },
    };
  }

  private async calcTaxDelinquency(lead: Lead, enrichment: EnrichmentData, weight: number): Promise<ScoreFactorResult> {
    const isDelinquent = enrichment.taxData?.delinquent === true || 
                         enrichment.parcelData?.taxDelinquent === true;
    const delinquentAmount = enrichment.taxData?.delinquentAmount || 0;
    
    let scoreMultiplier = 0;
    if (isDelinquent) {
      scoreMultiplier = 1.0;
    }
    
    return {
      value: isDelinquent,
      score: Math.round(weight * scoreMultiplier * 4),
      weight,
      explanation: isDelinquent 
        ? `Tax delinquent${delinquentAmount ? ` ($${delinquentAmount})` : ""}` 
        : "No tax delinquency detected",
      rawData: { isDelinquent, delinquentAmount },
    };
  }

  private async calcAbsenteeOwner(lead: Lead, enrichment: EnrichmentData, weight: number): Promise<ScoreFactorResult> {
    let isAbsentee = false;
    
    if (lead.state && enrichment.parcelData?.propertyState) {
      if (lead.state.toUpperCase() !== enrichment.parcelData.propertyState.toUpperCase()) {
        isAbsentee = true;
      }
    }
    
    if (enrichment.parcelData?.mailingDifferent) {
      isAbsentee = true;
    }
    
    return {
      value: isAbsentee,
      score: isAbsentee ? Math.round(weight * 4) : 0,
      weight,
      explanation: isAbsentee ? "Absentee owner detected" : "Owner appears local",
      rawData: { isAbsentee },
    };
  }

  private async calcPropertySize(lead: Lead, enrichment: EnrichmentData, weight: number): Promise<ScoreFactorResult> {
    const acres = enrichment.parcelData?.acres || enrichment.parcelData?.sizeAcres || 0;
    
    let scoreMultiplier = 0;
    if (acres >= 40) scoreMultiplier = 0.6;
    else if (acres >= 20) scoreMultiplier = 0.8;
    else if (acres >= 5) scoreMultiplier = 1.0;
    else if (acres >= 1) scoreMultiplier = 0.7;
    else if (acres > 0) scoreMultiplier = 0.4;
    
    return {
      value: acres,
      score: Math.round(weight * scoreMultiplier * 4),
      weight,
      explanation: acres > 0 ? `Property is ${acres.toFixed(2)} acres` : "Property size unknown",
      rawData: { acres },
    };
  }

  private async calcCorporateOwner(lead: Lead, weight: number): Promise<ScoreFactorResult> {
    const ownerName = `${lead.firstName} ${lead.lastName}`.toLowerCase();
    const corporateIndicators = ["llc", "inc", "corp", "trust", "estate", "ltd", "lp", "partnership"];
    
    const isCorporate = corporateIndicators.some(ind => ownerName.includes(ind));
    
    let entityType = "individual";
    if (ownerName.includes("llc")) entityType = "LLC";
    else if (ownerName.includes("trust")) entityType = "Trust";
    else if (ownerName.includes("estate")) entityType = "Estate";
    else if (ownerName.includes("inc") || ownerName.includes("corp")) entityType = "Corporation";
    
    return {
      value: isCorporate,
      score: isCorporate ? Math.round(weight * 3) : 0,
      weight,
      explanation: isCorporate ? `${entityType} ownership detected` : "Individual owner",
      rawData: { isCorporate, entityType },
    };
  }

  private async calcOutOfState(lead: Lead, enrichment: EnrichmentData, weight: number): Promise<ScoreFactorResult> {
    let isOutOfState = false;
    let ownerState = lead.state;
    let propertyState = enrichment.parcelData?.propertyState;
    
    if (lead.state && propertyState && lead.state.toUpperCase() !== propertyState.toUpperCase()) {
      isOutOfState = true;
    }
    
    return {
      value: isOutOfState,
      score: isOutOfState ? Math.round(weight * 4) : 0,
      weight,
      explanation: isOutOfState 
        ? `Owner in ${ownerState}, property in ${propertyState}` 
        : "Owner in same state as property",
      rawData: { isOutOfState, ownerState, propertyState },
    };
  }

  private async calcInheritanceIndicator(lead: Lead, weight: number): Promise<ScoreFactorResult> {
    const ownerName = `${lead.firstName} ${lead.lastName}`.toLowerCase();
    const inheritanceIndicators = ["estate of", "heir", "trust", "successor", "deceased", "personal rep"];
    
    const hasIndicator = inheritanceIndicators.some(ind => ownerName.includes(ind));
    let indicator = "";
    if (hasIndicator) {
      indicator = inheritanceIndicators.find(ind => ownerName.includes(ind)) || "";
    }
    
    return {
      value: hasIndicator,
      score: hasIndicator ? Math.round(weight * 4) : 0,
      weight,
      explanation: hasIndicator ? `Inheritance indicator: "${indicator}"` : "No inheritance indicators",
      rawData: { hasIndicator, indicator },
    };
  }

  private async calcFloodZone(enrichment: EnrichmentData, weight: number): Promise<ScoreFactorResult> {
    const floodZone = enrichment.floodData?.zone || enrichment.floodData?.floodZone || "unknown";
    const isHighRisk = ["A", "AE", "AH", "AO", "V", "VE"].some(z => floodZone.toUpperCase().startsWith(z));
    
    let scoreMultiplier = 0;
    if (isHighRisk) {
      scoreMultiplier = -0.5;
    } else if (floodZone.toUpperCase().startsWith("X") || floodZone.toLowerCase() === "minimal") {
      scoreMultiplier = 0.3;
    }
    
    return {
      value: floodZone,
      score: Math.round(weight * scoreMultiplier * 4),
      weight,
      explanation: isHighRisk 
        ? `High flood risk zone: ${floodZone}` 
        : floodZone !== "unknown" 
          ? `Flood zone: ${floodZone}` 
          : "Flood zone unknown",
      rawData: { floodZone, isHighRisk },
    };
  }

  private async calcResponseRecency(lead: Lead, weight: number): Promise<ScoreFactorResult> {
    let daysSinceResponse = -1;
    let scoreMultiplier = 0;
    
    if (lead.responses && lead.responses > 0 && lead.lastContactedAt) {
      const lastContact = new Date(lead.lastContactedAt);
      const now = new Date();
      daysSinceResponse = Math.floor((now.getTime() - lastContact.getTime()) / (24 * 60 * 60 * 1000));
      
      if (daysSinceResponse <= 7) scoreMultiplier = 1.0;
      else if (daysSinceResponse <= 14) scoreMultiplier = 0.8;
      else if (daysSinceResponse <= 30) scoreMultiplier = 0.6;
      else if (daysSinceResponse <= 60) scoreMultiplier = 0.3;
      else scoreMultiplier = 0.1;
    } else if ((lead.responses || 0) === 0) {
      scoreMultiplier = 0;
    }
    
    return {
      value: daysSinceResponse,
      score: Math.round(weight * scoreMultiplier * 4),
      weight,
      explanation: daysSinceResponse >= 0 
        ? `Last response ${daysSinceResponse} days ago` 
        : "No responses yet",
      rawData: { daysSinceResponse, responses: lead.responses },
    };
  }

  private async calcEmailEngagement(lead: Lead, weight: number): Promise<ScoreFactorResult> {
    const opens = lead.emailOpens || 0;
    const clicks = lead.emailClicks || 0;
    
    let scoreMultiplier = 0;
    if (clicks > 0) {
      scoreMultiplier = 1.0;
    } else if (opens >= 3) {
      scoreMultiplier = 0.7;
    } else if (opens >= 1) {
      scoreMultiplier = 0.4;
    }
    
    return {
      value: opens + clicks,
      score: Math.round(weight * scoreMultiplier * 4),
      weight,
      explanation: clicks > 0 
        ? `${clicks} email clicks, ${opens} opens` 
        : opens > 0 
          ? `${opens} email opens` 
          : "No email engagement",
      rawData: { opens, clicks },
    };
  }

  private async calcCampaignTouches(lead: Lead, weight: number): Promise<ScoreFactorResult> {
    const [touchCount] = await db.select({ count: count() })
      .from(leadActivities)
      .where(and(
        eq(leadActivities.leadId, lead.id),
        sql`${leadActivities.type} IN ('email_sent', 'sms_sent', 'mail_sent', 'call_made')`
      ));
    
    const touches = touchCount?.count || 0;
    
    let scoreMultiplier = 0;
    if (touches >= 5) scoreMultiplier = 0.3;
    else if (touches >= 3) scoreMultiplier = 0.5;
    else if (touches >= 1) scoreMultiplier = 0.2;
    
    return {
      value: touches,
      score: Math.round(weight * scoreMultiplier * 4),
      weight,
      explanation: touches > 0 ? `${touches} campaign touches` : "No campaign touches yet",
      rawData: { touches },
    };
  }

  private formatFactorsForStorage(factors: Record<string, ScoreFactorResult>): any {
    const formatted: any = {};
    for (const [key, factor] of Object.entries(factors)) {
      formatted[key] = {
        value: factor.value,
        score: factor.score,
        ...factor.rawData,
      };
    }
    return formatted;
  }

  async getScoreHistory(leadId: number, limit: number = 10): Promise<LeadScoreHistory[]> {
    return db.select().from(leadScoreHistory)
      .where(eq(leadScoreHistory.leadId, leadId))
      .orderBy(desc(leadScoreHistory.scoredAt))
      .limit(limit);
  }

  async recordConversion(
    leadId: number, 
    organizationId: number, 
    conversionType: string,
    metadata?: {
      campaignId?: number;
      campaignType?: string;
      touchNumber?: number;
      dealValue?: number;
      profitMargin?: number;
    }
  ): Promise<void> {
    const [latestScore] = await db.select().from(leadScoreHistory)
      .where(eq(leadScoreHistory.leadId, leadId))
      .orderBy(desc(leadScoreHistory.scoredAt))
      .limit(1);
    
    const [activities] = await db.select({ 
      firstTouch: sql`MIN(${leadActivities.createdAt})` 
    })
      .from(leadActivities)
      .where(eq(leadActivities.leadId, leadId));
    
    let daysFromFirstTouch = null;
    if (activities?.firstTouch) {
      const firstTouchDate = new Date(activities.firstTouch as string);
      const now = new Date();
      daysFromFirstTouch = Math.floor((now.getTime() - firstTouchDate.getTime()) / (24 * 60 * 60 * 1000));
    }
    
    let daysFromScore = null;
    if (latestScore?.scoredAt) {
      const scoreDate = new Date(latestScore.scoredAt);
      const now = new Date();
      daysFromScore = Math.floor((now.getTime() - scoreDate.getTime()) / (24 * 60 * 60 * 1000));
    }
    
    await db.insert(leadConversions).values({
      leadId,
      organizationId,
      conversionType,
      scoreAtConversion: latestScore?.score,
      campaignId: metadata?.campaignId,
      campaignType: metadata?.campaignType,
      touchNumber: metadata?.touchNumber,
      daysFromFirstTouch,
      daysFromScore,
      dealValue: metadata?.dealValue,
      profitMargin: metadata?.profitMargin,
    });
  }

  async getScoringStats(organizationId: number): Promise<{
    totalScored: number;
    avgScore: number;
    scoreDistribution: Record<string, number>;
    conversionRate: number;
    topFactors: { factor: string; avgContribution: number }[];
  }> {
    const [stats] = await db.select({
      totalScored: count(),
      avgScore: sql<number>`AVG(${leadScoreHistory.score})`,
    })
      .from(leadScoreHistory)
      .where(eq(leadScoreHistory.organizationId, organizationId));
    
    const [mailCount] = await db.select({ count: count() })
      .from(leadScoreHistory)
      .where(and(
        eq(leadScoreHistory.organizationId, organizationId),
        gte(leadScoreHistory.score, 100)
      ));
    
    const [maybeCount] = await db.select({ count: count() })
      .from(leadScoreHistory)
      .where(and(
        eq(leadScoreHistory.organizationId, organizationId),
        gte(leadScoreHistory.score, 0),
        sql`${leadScoreHistory.score} < 100`
      ));
    
    const [skipCount] = await db.select({ count: count() })
      .from(leadScoreHistory)
      .where(and(
        eq(leadScoreHistory.organizationId, organizationId),
        sql`${leadScoreHistory.score} < 0`
      ));
    
    const [conversionStats] = await db.select({
      total: count(),
    })
      .from(leadConversions)
      .where(eq(leadConversions.organizationId, organizationId));
    
    return {
      totalScored: stats?.totalScored || 0,
      avgScore: Math.round(stats?.avgScore || 0),
      scoreDistribution: {
        mail: mailCount?.count || 0,
        maybe: maybeCount?.count || 0,
        skip: skipCount?.count || 0,
      },
      conversionRate: stats?.totalScored 
        ? Math.round(((conversionStats?.total || 0) / stats.totalScored) * 100) 
        : 0,
      topFactors: [],
    };
  }
}

export const leadScoringService = new LeadScoringService();
