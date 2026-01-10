import { db } from "../db";
import {
  buyerProfiles,
  buyerPropertyMatches,
  properties,
  leads,
  agentEvents,
  type BuyerProfile,
  type InsertBuyerProfile,
  type BuyerPropertyMatch,
  type InsertBuyerPropertyMatch,
  type Property,
  type Lead,
} from "@shared/schema";
import { eq, and, desc, inArray, isNull, or } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

type ProfileType = "individual" | "investor" | "developer" | "builder";
type MatchStatus = "pending" | "presented" | "interested" | "not_interested" | "purchased";

interface BuyerPreferences {
  minAcreage?: number;
  maxAcreage?: number;
  minPrice?: number;
  maxPrice?: number;
  states?: string[];
  counties?: string[];
  zoningTypes?: string[];
  useTypes?: string[];
  roadAccess?: string[];
  utilities?: string[];
  terrainTypes?: string[];
  waterFeatures?: boolean;
}

interface FinancialInfo {
  budget?: number;
  preApproved?: boolean;
  preApprovalAmount?: number;
  financingType?: string;
  downPaymentCapacity?: number;
  monthlyPaymentCapacity?: number;
  creditScoreRange?: string;
}

interface BuyerIntent {
  purchaseTimeline?: string;
  primaryUse?: string;
  investmentGoal?: string;
  urgency?: number;
  previousPurchases?: number;
}

interface CreateBuyerProfileParams {
  leadId?: number;
  profileType: ProfileType;
  preferences: BuyerPreferences;
  financialInfo: FinancialInfo;
  intent: BuyerIntent;
}

interface MatchFactors {
  priceMatch: number;
  sizeMatch: number;
  locationMatch: number;
  zoningMatch: number;
  featureMatch: number;
  financingMatch: number;
}

interface PropertyMatchResult {
  propertyId: number;
  matchScore: number;
  matchFactors: MatchFactors;
  matchReasons: string[];
  potentialConcerns: string[];
}

interface BuyerPoolAnalysis {
  totalActiveBuyers: number;
  averageBudget: number;
  medianBudget: number;
  profileTypeDistribution: Record<ProfileType, number>;
  popularStates: Array<{ state: string; count: number }>;
  popularZoningTypes: Array<{ zoning: string; count: number }>;
  financingTypeDistribution: Record<string, number>;
  averageUrgency: number;
  timelineDistribution: Record<string, number>;
  aiInsights?: string;
}

export class BuyerMatchingAIService {

  async createBuyerProfile(
    organizationId: number,
    params: CreateBuyerProfileParams
  ): Promise<BuyerProfile> {
    const { leadId, profileType, preferences, financialInfo, intent } = params;

    const profile: InsertBuyerProfile = {
      organizationId,
      leadId: leadId ?? null,
      profileType,
      preferences,
      financialInfo,
      intent,
      isActive: true,
    };

    const [inserted] = await db.insert(buyerProfiles)
      .values(profile)
      .returning();

    await this.logEvent(organizationId, "buyer_profile_created", {
      profileId: inserted.id,
      leadId,
      profileType,
    }, "buyer_profile", inserted.id);

    return inserted;
  }

  async updateBuyerProfile(
    profileId: number,
    updates: Partial<{
      profileType: ProfileType;
      preferences: BuyerPreferences;
      financialInfo: FinancialInfo;
      intent: BuyerIntent;
      isActive: boolean;
      qualificationScore: number;
      matchConfidence: number;
    }>
  ): Promise<BuyerProfile> {
    const [updated] = await db.update(buyerProfiles)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(buyerProfiles.id, profileId))
      .returning();

    if (!updated) {
      throw new Error(`Buyer profile ${profileId} not found`);
    }

    await this.logEvent(updated.organizationId, "buyer_profile_updated", {
      profileId,
      updatedFields: Object.keys(updates),
    }, "buyer_profile", profileId);

    return updated;
  }

  async matchBuyerToProperties(
    organizationId: number,
    buyerProfileId: number
  ): Promise<BuyerPropertyMatch[]> {
    const [buyerProfile] = await db.select().from(buyerProfiles)
      .where(and(
        eq(buyerProfiles.id, buyerProfileId),
        eq(buyerProfiles.organizationId, organizationId)
      ));

    if (!buyerProfile) {
      throw new Error(`Buyer profile ${buyerProfileId} not found`);
    }

    const availableProperties = await db.select().from(properties)
      .where(and(
        eq(properties.organizationId, organizationId),
        or(
          eq(properties.status, "owned"),
          eq(properties.status, "listed")
        )
      ));

    const matchResults: PropertyMatchResult[] = [];

    for (const property of availableProperties) {
      const { score, factors, reasons, concerns } = this.calculateMatchScore(buyerProfile, property);
      
      if (score >= 40) {
        matchResults.push({
          propertyId: property.id,
          matchScore: score,
          matchFactors: factors,
          matchReasons: reasons,
          potentialConcerns: concerns,
        });
      }
    }

    matchResults.sort((a, b) => b.matchScore - a.matchScore);

    const createdMatches: BuyerPropertyMatch[] = [];

    for (const result of matchResults) {
      const existingMatch = await db.select().from(buyerPropertyMatches)
        .where(and(
          eq(buyerPropertyMatches.buyerProfileId, buyerProfileId),
          eq(buyerPropertyMatches.propertyId, result.propertyId)
        ))
        .limit(1);

      if (existingMatch.length > 0) {
        const [updated] = await db.update(buyerPropertyMatches)
          .set({
            matchScore: result.matchScore,
            matchFactors: result.matchFactors,
            matchReasons: result.matchReasons,
            potentialConcerns: result.potentialConcerns,
            updatedAt: new Date(),
          })
          .where(eq(buyerPropertyMatches.id, existingMatch[0].id))
          .returning();
        createdMatches.push(updated);
      } else {
        const match: InsertBuyerPropertyMatch = {
          organizationId,
          buyerProfileId,
          propertyId: result.propertyId,
          matchScore: result.matchScore,
          matchFactors: result.matchFactors,
          matchReasons: result.matchReasons,
          potentialConcerns: result.potentialConcerns,
          status: "pending",
        };

        const [inserted] = await db.insert(buyerPropertyMatches)
          .values(match)
          .returning();
        createdMatches.push(inserted);
      }
    }

    await this.logEvent(organizationId, "buyer_matched_to_properties", {
      buyerProfileId,
      matchCount: createdMatches.length,
      topMatchScore: matchResults[0]?.matchScore ?? 0,
    }, "buyer_profile", buyerProfileId);

    return createdMatches;
  }

  async matchPropertyToBuyers(
    organizationId: number,
    propertyId: number
  ): Promise<BuyerPropertyMatch[]> {
    const [property] = await db.select().from(properties)
      .where(and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, organizationId)
      ));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const activeBuyers = await db.select().from(buyerProfiles)
      .where(and(
        eq(buyerProfiles.organizationId, organizationId),
        eq(buyerProfiles.isActive, true)
      ));

    const matchResults: Array<{
      buyerProfileId: number;
      matchScore: number;
      matchFactors: MatchFactors;
      matchReasons: string[];
      potentialConcerns: string[];
    }> = [];

    for (const buyer of activeBuyers) {
      const { score, factors, reasons, concerns } = this.calculateMatchScore(buyer, property);
      
      if (score >= 40) {
        matchResults.push({
          buyerProfileId: buyer.id,
          matchScore: score,
          matchFactors: factors,
          matchReasons: reasons,
          potentialConcerns: concerns,
        });
      }
    }

    matchResults.sort((a, b) => b.matchScore - a.matchScore);

    const createdMatches: BuyerPropertyMatch[] = [];

    for (const result of matchResults) {
      const existingMatch = await db.select().from(buyerPropertyMatches)
        .where(and(
          eq(buyerPropertyMatches.buyerProfileId, result.buyerProfileId),
          eq(buyerPropertyMatches.propertyId, propertyId)
        ))
        .limit(1);

      if (existingMatch.length > 0) {
        const [updated] = await db.update(buyerPropertyMatches)
          .set({
            matchScore: result.matchScore,
            matchFactors: result.matchFactors,
            matchReasons: result.matchReasons,
            potentialConcerns: result.potentialConcerns,
            updatedAt: new Date(),
          })
          .where(eq(buyerPropertyMatches.id, existingMatch[0].id))
          .returning();
        createdMatches.push(updated);
      } else {
        const match: InsertBuyerPropertyMatch = {
          organizationId,
          buyerProfileId: result.buyerProfileId,
          propertyId,
          matchScore: result.matchScore,
          matchFactors: result.matchFactors,
          matchReasons: result.matchReasons,
          potentialConcerns: result.potentialConcerns,
          status: "pending",
        };

        const [inserted] = await db.insert(buyerPropertyMatches)
          .values(match)
          .returning();
        createdMatches.push(inserted);
      }
    }

    await this.logEvent(organizationId, "property_matched_to_buyers", {
      propertyId,
      matchCount: createdMatches.length,
      topMatchScore: matchResults[0]?.matchScore ?? 0,
    }, "property", propertyId);

    return createdMatches;
  }

  calculateMatchScore(
    buyerProfile: BuyerProfile,
    property: Property
  ): { score: number; factors: MatchFactors; reasons: string[]; concerns: string[] } {
    const preferences = buyerProfile.preferences as BuyerPreferences | null;
    const financialInfo = buyerProfile.financialInfo as FinancialInfo | null;
    const reasons: string[] = [];
    const concerns: string[] = [];

    const priceMatch = this.calculatePriceMatch(property, preferences, financialInfo, reasons, concerns);
    const sizeMatch = this.calculateSizeMatch(property, preferences, reasons, concerns);
    const locationMatch = this.calculateLocationMatch(property, preferences, reasons, concerns);
    const zoningMatch = this.calculateZoningMatch(property, preferences, reasons, concerns);
    const featureMatch = this.calculateFeatureMatch(property, preferences, reasons, concerns);
    const financingMatch = this.calculateFinancingMatch(property, financialInfo, reasons, concerns);

    const factors: MatchFactors = {
      priceMatch,
      sizeMatch,
      locationMatch,
      zoningMatch,
      featureMatch,
      financingMatch,
    };

    const weights = {
      priceMatch: 0.25,
      sizeMatch: 0.15,
      locationMatch: 0.20,
      zoningMatch: 0.15,
      featureMatch: 0.10,
      financingMatch: 0.15,
    };

    const score = Math.round(
      priceMatch * weights.priceMatch +
      sizeMatch * weights.sizeMatch +
      locationMatch * weights.locationMatch +
      zoningMatch * weights.zoningMatch +
      featureMatch * weights.featureMatch +
      financingMatch * weights.financingMatch
    );

    return { score, factors, reasons, concerns };
  }

  private calculatePriceMatch(
    property: Property,
    preferences: BuyerPreferences | null,
    financialInfo: FinancialInfo | null,
    reasons: string[],
    concerns: string[]
  ): number {
    const propertyPrice = property.listPrice 
      ? parseFloat(property.listPrice) 
      : property.marketValue 
        ? parseFloat(property.marketValue)
        : null;

    if (!propertyPrice) {
      concerns.push("Property price not available");
      return 50;
    }

    let maxBudget = financialInfo?.budget ?? preferences?.maxPrice ?? null;
    let minBudget = preferences?.minPrice ?? 0;

    if (!maxBudget) {
      return 60;
    }

    if (propertyPrice < minBudget) {
      concerns.push("Property price below buyer's minimum");
      return 40;
    }

    if (propertyPrice > maxBudget) {
      const overBudgetPercent = ((propertyPrice - maxBudget) / maxBudget) * 100;
      if (overBudgetPercent > 20) {
        concerns.push(`Property is ${overBudgetPercent.toFixed(0)}% over budget`);
        return 20;
      }
      concerns.push(`Property slightly over budget by ${overBudgetPercent.toFixed(0)}%`);
      return 60 - overBudgetPercent * 2;
    }

    const budgetUtilization = propertyPrice / maxBudget;
    if (budgetUtilization >= 0.7 && budgetUtilization <= 0.95) {
      reasons.push("Property price fits well within budget");
      return 100;
    } else if (budgetUtilization < 0.5) {
      reasons.push("Property is well under budget");
      return 85;
    }
    
    reasons.push("Property price is within budget range");
    return 90;
  }

  private calculateSizeMatch(
    property: Property,
    preferences: BuyerPreferences | null,
    reasons: string[],
    concerns: string[]
  ): number {
    const propertyAcres = property.sizeAcres ? parseFloat(property.sizeAcres) : null;

    if (!propertyAcres) {
      concerns.push("Property size not available");
      return 50;
    }

    const minAcres = preferences?.minAcreage ?? 0;
    const maxAcres = preferences?.maxAcreage ?? Infinity;

    if (propertyAcres < minAcres) {
      const underPercent = ((minAcres - propertyAcres) / minAcres) * 100;
      concerns.push(`Property is ${underPercent.toFixed(0)}% smaller than preferred`);
      return Math.max(20, 70 - underPercent);
    }

    if (maxAcres !== Infinity && propertyAcres > maxAcres) {
      const overPercent = ((propertyAcres - maxAcres) / maxAcres) * 100;
      if (overPercent > 50) {
        concerns.push(`Property is ${overPercent.toFixed(0)}% larger than preferred`);
        return 30;
      }
      concerns.push(`Property slightly larger than preferred`);
      return 70 - overPercent * 0.5;
    }

    reasons.push(`Property size (${propertyAcres.toFixed(2)} acres) matches preferences`);
    return 100;
  }

  private calculateLocationMatch(
    property: Property,
    preferences: BuyerPreferences | null,
    reasons: string[],
    concerns: string[]
  ): number {
    if (!preferences) return 60;

    const preferredStates = preferences.states ?? [];
    const preferredCounties = preferences.counties ?? [];

    if (preferredStates.length === 0 && preferredCounties.length === 0) {
      return 70;
    }

    let stateMatch = false;
    let countyMatch = false;

    if (preferredStates.length > 0) {
      stateMatch = preferredStates.some(
        s => s.toLowerCase() === property.state?.toLowerCase()
      );
    }

    if (preferredCounties.length > 0) {
      countyMatch = preferredCounties.some(
        c => c.toLowerCase() === property.county?.toLowerCase()
      );
    }

    if (countyMatch) {
      reasons.push(`Property in preferred county: ${property.county}`);
      return 100;
    }

    if (stateMatch) {
      reasons.push(`Property in preferred state: ${property.state}`);
      return 85;
    }

    concerns.push(`Property not in buyer's preferred locations`);
    return 30;
  }

  private calculateZoningMatch(
    property: Property,
    preferences: BuyerPreferences | null,
    reasons: string[],
    concerns: string[]
  ): number {
    if (!preferences) return 60;

    const preferredZoning = preferences.zoningTypes ?? [];
    const preferredUses = preferences.useTypes ?? [];

    if (preferredZoning.length === 0 && preferredUses.length === 0) {
      return 70;
    }

    const propertyZoning = property.zoning?.toLowerCase() ?? "";

    if (preferredZoning.length > 0 && propertyZoning) {
      const zoningMatch = preferredZoning.some(
        z => propertyZoning.includes(z.toLowerCase())
      );
      if (zoningMatch) {
        reasons.push(`Zoning (${property.zoning}) matches buyer preferences`);
        return 100;
      }
    }

    if (preferredUses.length > 0 && propertyZoning) {
      const zoningToUseMap: Record<string, string[]> = {
        residential: ["residential", "r-1", "r-2", "single family", "multi-family"],
        commercial: ["commercial", "c-1", "c-2", "retail", "office"],
        agricultural: ["agricultural", "ag", "farm", "ranch"],
        recreational: ["recreational", "open space", "conservation"],
        industrial: ["industrial", "m-1", "m-2", "manufacturing"],
      };

      for (const use of preferredUses) {
        const matchingZones = zoningToUseMap[use.toLowerCase()] ?? [];
        if (matchingZones.some(z => propertyZoning.includes(z))) {
          reasons.push(`Property zoning supports ${use} use`);
          return 90;
        }
      }
    }

    if (!propertyZoning) {
      concerns.push("Property zoning information not available");
      return 50;
    }

    concerns.push("Property zoning may not match preferred uses");
    return 40;
  }

  private calculateFeatureMatch(
    property: Property,
    preferences: BuyerPreferences | null,
    reasons: string[],
    concerns: string[]
  ): number {
    if (!preferences) return 60;

    let matchedFeatures = 0;
    let totalPreferences = 0;

    if (preferences.roadAccess && preferences.roadAccess.length > 0) {
      totalPreferences++;
      const propertyAccess = property.roadAccess?.toLowerCase() ?? "";
      if (preferences.roadAccess.some(r => propertyAccess.includes(r.toLowerCase()))) {
        matchedFeatures++;
        reasons.push(`Has preferred road access: ${property.roadAccess}`);
      } else if (propertyAccess) {
        concerns.push(`Road access (${property.roadAccess}) may not match preference`);
      }
    }

    if (preferences.utilities && preferences.utilities.length > 0) {
      totalPreferences++;
      const propertyUtilities = property.utilities as { electric?: boolean; water?: boolean; sewer?: boolean; gas?: boolean } | null;
      if (propertyUtilities) {
        const hasRequiredUtilities = preferences.utilities.every(u => {
          const key = u.toLowerCase() as keyof typeof propertyUtilities;
          return propertyUtilities[key] === true;
        });
        if (hasRequiredUtilities) {
          matchedFeatures++;
          reasons.push("Property has all required utilities");
        } else {
          concerns.push("Property may be missing some required utilities");
        }
      }
    }

    if (preferences.terrainTypes && preferences.terrainTypes.length > 0) {
      totalPreferences++;
      const propertyTerrain = property.terrain?.toLowerCase() ?? "";
      if (preferences.terrainTypes.some(t => propertyTerrain.includes(t.toLowerCase()))) {
        matchedFeatures++;
        reasons.push(`Terrain (${property.terrain}) matches preference`);
      }
    }

    if (totalPreferences === 0) {
      return 70;
    }

    const score = Math.round((matchedFeatures / totalPreferences) * 100);
    return Math.max(30, score);
  }

  private calculateFinancingMatch(
    property: Property,
    financialInfo: FinancialInfo | null,
    reasons: string[],
    concerns: string[]
  ): number {
    if (!financialInfo) return 60;

    const propertyPrice = property.listPrice 
      ? parseFloat(property.listPrice) 
      : property.marketValue 
        ? parseFloat(property.marketValue)
        : null;

    if (!propertyPrice) return 50;

    const financingType = financialInfo.financingType?.toLowerCase() ?? "";

    if (financingType === "cash") {
      if (financialInfo.budget && propertyPrice <= financialInfo.budget) {
        reasons.push("Buyer has cash to purchase");
        return 100;
      }
      concerns.push("Property may exceed cash available");
      return 60;
    }

    if (financingType === "owner_finance") {
      if (financialInfo.downPaymentCapacity && financialInfo.monthlyPaymentCapacity) {
        const typicalDownPayment = propertyPrice * 0.10;
        const typicalMonthlyPayment = (propertyPrice * 0.90) / 60; // 5 year term estimate

        if (
          financialInfo.downPaymentCapacity >= typicalDownPayment &&
          financialInfo.monthlyPaymentCapacity >= typicalMonthlyPayment
        ) {
          reasons.push("Buyer qualifies for owner financing");
          return 95;
        }
        concerns.push("Buyer may need flexible owner financing terms");
        return 70;
      }
    }

    if (financialInfo.preApproved && financialInfo.preApprovalAmount) {
      if (propertyPrice <= financialInfo.preApprovalAmount) {
        reasons.push("Buyer pre-approved for this price range");
        return 100;
      }
      concerns.push("Property exceeds pre-approval amount");
      return 50;
    }

    return 60;
  }

  async generateMatchPitch(matchId: number): Promise<string> {
    const [match] = await db.select().from(buyerPropertyMatches)
      .where(eq(buyerPropertyMatches.id, matchId));

    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    const [property] = await db.select().from(properties)
      .where(eq(properties.id, match.propertyId));

    const [buyerProfile] = await db.select().from(buyerProfiles)
      .where(eq(buyerProfiles.id, match.buyerProfileId));

    if (!property || !buyerProfile) {
      throw new Error("Property or buyer profile not found");
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return this.generateDefaultPitch(match, property, buyerProfile);
    }

    const preferences = buyerProfile.preferences as BuyerPreferences | null;
    const intent = buyerProfile.intent as BuyerIntent | null;
    const matchReasons = (match.matchReasons as string[]) ?? [];

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert land sales specialist. Create a personalized, compelling pitch to present a property to a buyer. 
Keep it conversational, highlight why this property is a great match for their specific needs, and include a clear call to action.
The pitch should be 2-3 short paragraphs, professional but warm.`
          },
          {
            role: "user",
            content: `Create a pitch for this property to buyer:

Property Details:
- Location: ${property.county}, ${property.state}
- Size: ${property.sizeAcres} acres
- Price: ${property.listPrice ?? property.marketValue ?? "Contact for pricing"}
- Zoning: ${property.zoning ?? "Check with county"}
- Road Access: ${property.roadAccess ?? "TBD"}
- Description: ${property.description ?? "Beautiful land opportunity"}

Buyer Profile:
- Type: ${buyerProfile.profileType}
- Looking for: ${preferences?.useTypes?.join(", ") ?? "land investment"}
- Budget: ${(buyerProfile.financialInfo as FinancialInfo | null)?.budget ?? "Flexible"}
- Timeline: ${intent?.purchaseTimeline ?? "Flexible"}
- Investment Goal: ${intent?.investmentGoal ?? "Not specified"}

Why this matches:
${matchReasons.map(r => `- ${r}`).join("\n")}

Match Score: ${match.matchScore}/100`
          }
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const pitch = response.choices[0]?.message?.content ?? this.generateDefaultPitch(match, property, buyerProfile);

      await db.update(buyerPropertyMatches)
        .set({ suggestedPitch: pitch, updatedAt: new Date() })
        .where(eq(buyerPropertyMatches.id, matchId));

      return pitch;
    } catch (error) {
      console.error("Error generating AI pitch:", error);
      return this.generateDefaultPitch(match, property, buyerProfile);
    }
  }

  private generateDefaultPitch(
    match: BuyerPropertyMatch,
    property: Property,
    buyerProfile: BuyerProfile
  ): string {
    const preferences = buyerProfile.preferences as BuyerPreferences | null;
    const matchReasons = (match.matchReasons as string[]) ?? [];

    return `I found a property that matches what you're looking for! This ${property.sizeAcres}-acre parcel in ${property.county}, ${property.state} ${matchReasons.length > 0 ? matchReasons[0].toLowerCase() : "fits your criteria well"}.

${property.description ?? `This property offers great potential for ${preferences?.useTypes?.[0] ?? "your land investment goals"}.`}

${property.listPrice ? `Listed at $${parseFloat(property.listPrice).toLocaleString()}. ` : ""}Would you like to schedule a call to discuss this opportunity?`;
  }

  async presentMatchToBuyer(matchId: number): Promise<BuyerPropertyMatch> {
    const [updated] = await db.update(buyerPropertyMatches)
      .set({
        status: "presented",
        presentedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(buyerPropertyMatches.id, matchId))
      .returning();

    if (!updated) {
      throw new Error(`Match ${matchId} not found`);
    }

    await this.logEvent(updated.organizationId, "match_presented_to_buyer", {
      matchId,
      buyerProfileId: updated.buyerProfileId,
      propertyId: updated.propertyId,
    }, "buyer_property_match", matchId);

    return updated;
  }

  async recordBuyerResponse(
    matchId: number,
    response: string,
    status: MatchStatus
  ): Promise<BuyerPropertyMatch> {
    const [updated] = await db.update(buyerPropertyMatches)
      .set({
        status,
        buyerResponse: response,
        updatedAt: new Date(),
      })
      .where(eq(buyerPropertyMatches.id, matchId))
      .returning();

    if (!updated) {
      throw new Error(`Match ${matchId} not found`);
    }

    await this.logEvent(updated.organizationId, "buyer_response_recorded", {
      matchId,
      buyerProfileId: updated.buyerProfileId,
      propertyId: updated.propertyId,
      status,
      response,
    }, "buyer_property_match", matchId);

    return updated;
  }

  async getTopMatchesForBuyer(
    organizationId: number,
    buyerProfileId: number,
    limit: number = 10
  ): Promise<BuyerPropertyMatch[]> {
    return db.select().from(buyerPropertyMatches)
      .where(and(
        eq(buyerPropertyMatches.organizationId, organizationId),
        eq(buyerPropertyMatches.buyerProfileId, buyerProfileId)
      ))
      .orderBy(desc(buyerPropertyMatches.matchScore))
      .limit(limit);
  }

  async getTopBuyersForProperty(
    organizationId: number,
    propertyId: number,
    limit: number = 10
  ): Promise<BuyerPropertyMatch[]> {
    return db.select().from(buyerPropertyMatches)
      .where(and(
        eq(buyerPropertyMatches.organizationId, organizationId),
        eq(buyerPropertyMatches.propertyId, propertyId)
      ))
      .orderBy(desc(buyerPropertyMatches.matchScore))
      .limit(limit);
  }

  async getActiveBuyerProfiles(organizationId: number): Promise<BuyerProfile[]> {
    return db.select().from(buyerProfiles)
      .where(and(
        eq(buyerProfiles.organizationId, organizationId),
        eq(buyerProfiles.isActive, true)
      ))
      .orderBy(desc(buyerProfiles.createdAt));
  }

  async analyzeBuyerPreferences(organizationId: number): Promise<BuyerPoolAnalysis> {
    const activeBuyers = await this.getActiveBuyerProfiles(organizationId);

    if (activeBuyers.length === 0) {
      return {
        totalActiveBuyers: 0,
        averageBudget: 0,
        medianBudget: 0,
        profileTypeDistribution: { individual: 0, investor: 0, developer: 0, builder: 0 },
        popularStates: [],
        popularZoningTypes: [],
        financingTypeDistribution: {},
        averageUrgency: 0,
        timelineDistribution: {},
      };
    }

    const budgets: number[] = [];
    const profileTypes: Record<ProfileType, number> = { individual: 0, investor: 0, developer: 0, builder: 0 };
    const stateCount: Record<string, number> = {};
    const zoningCount: Record<string, number> = {};
    const financingTypes: Record<string, number> = {};
    const timelines: Record<string, number> = {};
    let urgencySum = 0;
    let urgencyCount = 0;

    for (const buyer of activeBuyers) {
      const financialInfo = buyer.financialInfo as FinancialInfo | null;
      const preferences = buyer.preferences as BuyerPreferences | null;
      const intent = buyer.intent as BuyerIntent | null;

      if (financialInfo?.budget) {
        budgets.push(financialInfo.budget);
      }

      const profileType = buyer.profileType as ProfileType;
      if (profileTypes.hasOwnProperty(profileType)) {
        profileTypes[profileType]++;
      }

      if (preferences?.states) {
        for (const state of preferences.states) {
          stateCount[state] = (stateCount[state] ?? 0) + 1;
        }
      }

      if (preferences?.zoningTypes) {
        for (const zoning of preferences.zoningTypes) {
          zoningCount[zoning] = (zoningCount[zoning] ?? 0) + 1;
        }
      }

      if (financialInfo?.financingType) {
        financingTypes[financialInfo.financingType] = (financingTypes[financialInfo.financingType] ?? 0) + 1;
      }

      if (intent?.purchaseTimeline) {
        timelines[intent.purchaseTimeline] = (timelines[intent.purchaseTimeline] ?? 0) + 1;
      }

      if (intent?.urgency) {
        urgencySum += intent.urgency;
        urgencyCount++;
      }
    }

    budgets.sort((a, b) => a - b);
    const averageBudget = budgets.length > 0 
      ? budgets.reduce((sum, b) => sum + b, 0) / budgets.length 
      : 0;
    const medianBudget = budgets.length > 0 
      ? budgets[Math.floor(budgets.length / 2)] 
      : 0;

    const popularStates = Object.entries(stateCount)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const popularZoningTypes = Object.entries(zoningCount)
      .map(([zoning, count]) => ({ zoning, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const analysis: BuyerPoolAnalysis = {
      totalActiveBuyers: activeBuyers.length,
      averageBudget: Math.round(averageBudget),
      medianBudget: Math.round(medianBudget),
      profileTypeDistribution: profileTypes,
      popularStates,
      popularZoningTypes,
      financingTypeDistribution: financingTypes,
      averageUrgency: urgencyCount > 0 ? urgencySum / urgencyCount : 0,
      timelineDistribution: timelines,
    };

    const openai = getOpenAIClient();
    if (openai && activeBuyers.length >= 5) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are a real estate market analyst. Provide brief, actionable insights about a buyer pool. Keep it to 2-3 sentences."
            },
            {
              role: "user",
              content: `Analyze this buyer pool data and provide insights:
- Total buyers: ${analysis.totalActiveBuyers}
- Average budget: $${analysis.averageBudget.toLocaleString()}
- Median budget: $${analysis.medianBudget.toLocaleString()}
- Profile types: ${JSON.stringify(profileTypes)}
- Popular states: ${popularStates.map(s => s.state).join(", ")}
- Common financing: ${Object.keys(financingTypes).join(", ")}
- Average urgency (1-10): ${analysis.averageUrgency.toFixed(1)}`
            }
          ],
          max_tokens: 200,
          temperature: 0.7,
        });

        analysis.aiInsights = response.choices[0]?.message?.content ?? undefined;
      } catch (error) {
        console.error("Error generating AI insights:", error);
      }
    }

    await this.logEvent(organizationId, "buyer_preferences_analyzed", {
      totalBuyers: analysis.totalActiveBuyers,
      averageBudget: analysis.averageBudget,
    }, "organization", organizationId);

    return analysis;
  }

  private async logEvent(
    organizationId: number,
    eventType: string,
    payload: Record<string, any>,
    relatedEntityType?: string,
    relatedEntityId?: number
  ): Promise<void> {
    try {
      await db.insert(agentEvents).values({
        organizationId,
        eventType,
        eventSource: "system",
        payload,
        relatedEntityType,
        relatedEntityId,
      });
    } catch (error) {
      console.error("Error logging event:", error);
    }
  }
}

export const buyerMatchingAIService = new BuyerMatchingAIService();
