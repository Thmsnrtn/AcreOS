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
    
    return factors;
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
