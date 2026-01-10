import { db } from "../db";
import {
  dealPatterns,
  dealPatternMatches,
  deals,
  properties,
  leads,
  type DealPattern,
  type DealPatternMatch,
  type InsertDealPattern,
  type InsertDealPatternMatch,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";

export interface PatternFingerprint {
  property: {
    acreage: number;
    county: string;
    state: string;
    zoning?: string;
    terrain?: string;
    roadAccess?: string;
    utilities?: string[];
  };
  deal: {
    type: string;
    offerToAskRatio?: number;
    daysToClose?: number;
    negotiationRounds?: number;
    finalMargin?: number;
  };
  seller?: {
    type?: string;
    motivation?: string[];
    responsePattern?: string;
  };
  market?: {
    pricePerAcre: number;
    marketTrend?: string;
    competitionLevel?: string;
  };
}

export interface SimilarityWeights {
  property: number;
  deal: number;
  seller: number;
  market: number;
  geographic: number;
}

export interface PatternMatchResult {
  pattern: DealPattern;
  similarityScore: number;
  matchedDimensions: {
    propertyMatch: number;
    dealMatch: number;
    sellerMatch: number;
    marketMatch: number;
  };
}

export interface DerivedInsights {
  recommendedOffer?: number;
  expectedNegotiationRounds?: number;
  estimatedDaysToClose?: number;
  suggestedApproach?: string;
  watchOutFor?: string[];
  leveragePoints?: string[];
}

export interface PatternPerformanceResult {
  totalPatterns: number;
  successfulPatterns: number;
  averageRoi: number;
  topPerformingPatterns: {
    patternId: number;
    matchCount: number;
    successRate: number;
    avgProfit: number;
  }[];
  patternsByOutcome: {
    success: number;
    partialSuccess: number;
    failure: number;
  };
}

const DEFAULT_WEIGHTS: SimilarityWeights = {
  property: 0.35,
  deal: 0.25,
  seller: 0.15,
  market: 0.15,
  geographic: 0.10,
};

class DealPatternCloningService {
  private weights: SimilarityWeights = DEFAULT_WEIGHTS;

  async extractPattern(
    organizationId: number,
    dealId: number
  ): Promise<PatternFingerprint | null> {
    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, organizationId)))
      .limit(1);

    if (!deal) return null;

    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, deal.propertyId))
      .limit(1);

    if (!property) return null;

    let seller = null;
    if (property.sellerId) {
      const [sellerData] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, property.sellerId))
        .limit(1);
      seller = sellerData;
    }

    const acreage = property.sizeAcres ? parseFloat(property.sizeAcres as string) : 0;
    const assessedValue = property.assessedValue ? parseFloat(property.assessedValue as string) : 0;
    const offerAmount = deal.offerAmount ? parseFloat(deal.offerAmount as string) : 0;
    const acceptedAmount = deal.acceptedAmount ? parseFloat(deal.acceptedAmount as string) : 0;
    const purchasePrice = property.purchasePrice ? parseFloat(property.purchasePrice as string) : 0;
    const soldPrice = property.soldPrice ? parseFloat(property.soldPrice as string) : 0;

    const utilities: string[] = [];
    if (property.utilities) {
      const u = property.utilities as { electric?: boolean; water?: boolean; sewer?: boolean; gas?: boolean };
      if (u.electric) utilities.push("electric");
      if (u.water) utilities.push("water");
      if (u.sewer) utilities.push("sewer");
      if (u.gas) utilities.push("gas");
    }

    let daysToClose: number | undefined;
    if (deal.closingDate && deal.offerDate) {
      daysToClose = Math.floor(
        (new Date(deal.closingDate).getTime() - new Date(deal.offerDate).getTime()) /
        (1000 * 60 * 60 * 24)
      );
    }

    let offerToAskRatio: number | undefined;
    if (offerAmount && assessedValue) {
      offerToAskRatio = offerAmount / assessedValue;
    }

    let finalMargin: number | undefined;
    if (deal.type === "acquisition" && purchasePrice && soldPrice) {
      finalMargin = ((soldPrice - purchasePrice) / purchasePrice) * 100;
    } else if (deal.type === "disposition" && acceptedAmount && purchasePrice) {
      finalMargin = ((acceptedAmount - purchasePrice) / purchasePrice) * 100;
    }

    const pricePerAcre = acreage > 0 ? (acceptedAmount || purchasePrice) / acreage : 0;

    const fingerprint: PatternFingerprint = {
      property: {
        acreage,
        county: property.county,
        state: property.state,
        zoning: property.zoning || undefined,
        terrain: property.terrain || undefined,
        roadAccess: property.roadAccess || undefined,
        utilities: utilities.length > 0 ? utilities : undefined,
      },
      deal: {
        type: deal.type,
        offerToAskRatio,
        daysToClose,
        finalMargin,
      },
      market: {
        pricePerAcre,
      },
    };

    if (seller) {
      const motivation: string[] = [];
      if (seller.tags && Array.isArray(seller.tags)) {
        const motivationTags = (seller.tags as string[]).filter(
          (t: string) => ["motivated", "inherited", "tax_delinquent", "distressed", "estate"].includes(t.toLowerCase())
        );
        motivation.push(...motivationTags);
      }

      fingerprint.seller = {
        type: this.detectSellerType(seller),
        motivation: motivation.length > 0 ? motivation : undefined,
      };
    }

    return fingerprint;
  }

  private detectSellerType(seller: any): string {
    const name = `${seller.firstName || ""} ${seller.lastName || ""}`.toUpperCase();
    const corporateIndicators = ["LLC", "INC", "CORP", "LP", "LLP", "TRUST", "ESTATE", "COMPANY"];
    
    if (corporateIndicators.some((ind) => name.includes(ind))) {
      if (name.includes("ESTATE") || name.includes("TRUST")) {
        return "estate";
      }
      return "corporate";
    }
    return "individual";
  }

  async findSimilarPatterns(
    organizationId: number,
    propertyId: number,
    topN: number = 5
  ): Promise<PatternMatchResult[]> {
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);

    if (!property) return [];

    const targetFingerprint = await this.generatePropertyFingerprint(property);

    const patterns = await db
      .select()
      .from(dealPatterns)
      .where(eq(dealPatterns.organizationId, organizationId))
      .orderBy(desc(dealPatterns.createdAt));

    const scoredPatterns: PatternMatchResult[] = [];

    for (const pattern of patterns) {
      if (!pattern.fingerprint) continue;

      const patternFingerprint = pattern.fingerprint as PatternFingerprint;
      const similarity = this.calculateSimilarity(targetFingerprint, patternFingerprint);

      scoredPatterns.push({
        pattern,
        similarityScore: similarity.overall,
        matchedDimensions: {
          propertyMatch: similarity.property,
          dealMatch: similarity.deal,
          sellerMatch: similarity.seller,
          marketMatch: similarity.market,
        },
      });
    }

    scoredPatterns.sort((a, b) => b.similarityScore - a.similarityScore);

    return scoredPatterns.slice(0, topN);
  }

  private async generatePropertyFingerprint(property: any): Promise<PatternFingerprint> {
    const acreage = property.sizeAcres ? parseFloat(property.sizeAcres as string) : 0;
    const assessedValue = property.assessedValue ? parseFloat(property.assessedValue as string) : 0;

    const utilities: string[] = [];
    if (property.utilities) {
      const u = property.utilities as { electric?: boolean; water?: boolean; sewer?: boolean; gas?: boolean };
      if (u.electric) utilities.push("electric");
      if (u.water) utilities.push("water");
      if (u.sewer) utilities.push("sewer");
      if (u.gas) utilities.push("gas");
    }

    const pricePerAcre = acreage > 0 && assessedValue > 0 ? assessedValue / acreage : 0;

    return {
      property: {
        acreage,
        county: property.county,
        state: property.state,
        zoning: property.zoning || undefined,
        terrain: property.terrain || undefined,
        roadAccess: property.roadAccess || undefined,
        utilities: utilities.length > 0 ? utilities : undefined,
      },
      deal: {
        type: "acquisition",
      },
      market: {
        pricePerAcre,
      },
    };
  }

  calculateSimilarity(
    targetFingerprint: PatternFingerprint,
    patternFingerprint: PatternFingerprint
  ): { overall: number; property: number; deal: number; seller: number; market: number } {
    const propertySimilarity = this.calculatePropertySimilarity(
      targetFingerprint.property,
      patternFingerprint.property
    );

    const dealSimilarity = this.calculateDealSimilarity(
      targetFingerprint.deal,
      patternFingerprint.deal
    );

    const sellerSimilarity = this.calculateSellerSimilarity(
      targetFingerprint.seller,
      patternFingerprint.seller
    );

    const marketSimilarity = this.calculateMarketSimilarity(
      targetFingerprint.market,
      patternFingerprint.market
    );

    const geographicBonus = this.calculateGeographicBonus(
      targetFingerprint.property,
      patternFingerprint.property
    );

    const overall =
      propertySimilarity * this.weights.property +
      dealSimilarity * this.weights.deal +
      sellerSimilarity * this.weights.seller +
      marketSimilarity * this.weights.market +
      geographicBonus * this.weights.geographic;

    return {
      overall: Math.min(1, overall),
      property: propertySimilarity,
      deal: dealSimilarity,
      seller: sellerSimilarity,
      market: marketSimilarity,
    };
  }

  private calculatePropertySimilarity(
    target: PatternFingerprint["property"],
    pattern: PatternFingerprint["property"]
  ): number {
    let score = 0;
    let factors = 0;

    const sizeSimilarity = this.normalizedEuclidean(target.acreage, pattern.acreage, 1000);
    score += sizeSimilarity;
    factors++;

    if (target.zoning && pattern.zoning) {
      score += target.zoning === pattern.zoning ? 1 : 0.3;
      factors++;
    }

    if (target.terrain && pattern.terrain) {
      score += target.terrain === pattern.terrain ? 1 : 0.5;
      factors++;
    }

    if (target.roadAccess && pattern.roadAccess) {
      score += target.roadAccess === pattern.roadAccess ? 1 : 0.5;
      factors++;
    }

    if (target.utilities && pattern.utilities) {
      score += this.jaccardSimilarity(target.utilities, pattern.utilities);
      factors++;
    }

    return factors > 0 ? score / factors : 0;
  }

  private calculateDealSimilarity(
    target: PatternFingerprint["deal"],
    pattern: PatternFingerprint["deal"]
  ): number {
    let score = 0;
    let factors = 0;

    if (target.type === pattern.type) {
      score += 1;
    } else {
      score += 0.3;
    }
    factors++;

    if (target.offerToAskRatio !== undefined && pattern.offerToAskRatio !== undefined) {
      score += this.normalizedEuclidean(target.offerToAskRatio, pattern.offerToAskRatio, 1);
      factors++;
    }

    if (target.daysToClose !== undefined && pattern.daysToClose !== undefined) {
      score += this.normalizedEuclidean(target.daysToClose, pattern.daysToClose, 365);
      factors++;
    }

    return factors > 0 ? score / factors : 0;
  }

  private calculateSellerSimilarity(
    target?: PatternFingerprint["seller"],
    pattern?: PatternFingerprint["seller"]
  ): number {
    if (!target || !pattern) return 0.5;

    let score = 0;
    let factors = 0;

    if (target.type && pattern.type) {
      score += target.type === pattern.type ? 1 : 0.3;
      factors++;
    }

    if (target.motivation && pattern.motivation) {
      score += this.jaccardSimilarity(target.motivation, pattern.motivation);
      factors++;
    }

    if (target.responsePattern && pattern.responsePattern) {
      score += target.responsePattern === pattern.responsePattern ? 1 : 0.5;
      factors++;
    }

    return factors > 0 ? score / factors : 0.5;
  }

  private calculateMarketSimilarity(
    target?: PatternFingerprint["market"],
    pattern?: PatternFingerprint["market"]
  ): number {
    if (!target || !pattern) return 0.5;

    let score = 0;
    let factors = 0;

    if (target.pricePerAcre && pattern.pricePerAcre) {
      score += this.normalizedEuclidean(target.pricePerAcre, pattern.pricePerAcre, 50000);
      factors++;
    }

    if (target.marketTrend && pattern.marketTrend) {
      score += target.marketTrend === pattern.marketTrend ? 1 : 0.5;
      factors++;
    }

    if (target.competitionLevel && pattern.competitionLevel) {
      score += target.competitionLevel === pattern.competitionLevel ? 1 : 0.5;
      factors++;
    }

    return factors > 0 ? score / factors : 0.5;
  }

  private calculateGeographicBonus(
    target: PatternFingerprint["property"],
    pattern: PatternFingerprint["property"]
  ): number {
    if (target.county === pattern.county && target.state === pattern.state) {
      return 1;
    }
    if (target.state === pattern.state) {
      return 0.5;
    }
    return 0;
  }

  private normalizedEuclidean(a: number, b: number, maxRange: number): number {
    const distance = Math.abs(a - b) / maxRange;
    return Math.max(0, 1 - distance);
  }

  private jaccardSimilarity(setA: string[], setB: string[]): number {
    const a = setA.map((s) => s.toLowerCase());
    const b = setB.map((s) => s.toLowerCase());

    const setASet = new Set(a);
    const setBSet = new Set(b);

    let intersectionCount = 0;
    for (const item of a) {
      if (setBSet.has(item)) {
        intersectionCount++;
      }
    }

    const unionSet = new Set(a.concat(b));

    if (unionSet.size === 0) return 0;
    return intersectionCount / unionSet.size;
  }

  async deriveInsights(patternMatch: PatternMatchResult): Promise<DerivedInsights> {
    const pattern = patternMatch.pattern;
    const fingerprint = pattern.fingerprint as PatternFingerprint;
    const successFactors = pattern.successFactors as string[] | null;
    const challengesFaced = pattern.challengesFaced as string[] | null;

    const insights: DerivedInsights = {};

    if (fingerprint.deal?.offerToAskRatio && fingerprint.market?.pricePerAcre) {
      insights.recommendedOffer =
        fingerprint.market.pricePerAcre *
        fingerprint.property.acreage *
        fingerprint.deal.offerToAskRatio;
    }

    if (fingerprint.deal?.daysToClose) {
      insights.estimatedDaysToClose = fingerprint.deal.daysToClose;
    }

    if (fingerprint.deal?.negotiationRounds) {
      insights.expectedNegotiationRounds = fingerprint.deal.negotiationRounds;
    }

    if (challengesFaced && challengesFaced.length > 0) {
      insights.watchOutFor = challengesFaced;
    }

    if (successFactors && successFactors.length > 0) {
      insights.leveragePoints = successFactors;
    }

    if (fingerprint.seller?.motivation?.length) {
      const motivations = fingerprint.seller.motivation;
      if (motivations.includes("motivated") || motivations.includes("distressed")) {
        insights.suggestedApproach = "Quick, decisive offer with short contingencies. Seller appears motivated.";
      } else if (motivations.includes("inherited") || motivations.includes("estate")) {
        insights.suggestedApproach = "Patient approach with clear communication. Estate situations may need time for decisions.";
      }
    }

    return insights;
  }

  async recordPatternFromClosedDeal(
    organizationId: number,
    dealId: number
  ): Promise<DealPattern | null> {
    const fingerprint = await this.extractPattern(organizationId, dealId);
    if (!fingerprint) return null;

    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, organizationId)))
      .limit(1);

    if (!deal || deal.status !== "closed") return null;

    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, deal.propertyId))
      .limit(1);

    const purchasePrice = property?.purchasePrice
      ? parseFloat(property.purchasePrice as string)
      : 0;
    const acceptedAmount = deal.acceptedAmount
      ? parseFloat(deal.acceptedAmount as string)
      : 0;
    const soldPrice = property?.soldPrice
      ? parseFloat(property.soldPrice as string)
      : 0;

    let profitAmount = 0;
    let roiPercent = 0;

    if (deal.type === "disposition" && acceptedAmount && purchasePrice) {
      profitAmount = acceptedAmount - purchasePrice;
      roiPercent = purchasePrice > 0 ? (profitAmount / purchasePrice) * 100 : 0;
    } else if (deal.type === "acquisition" && soldPrice && purchasePrice) {
      profitAmount = soldPrice - purchasePrice;
      roiPercent = purchasePrice > 0 ? (profitAmount / purchasePrice) * 100 : 0;
    }

    let daysToComplete: number | undefined;
    if (deal.closingDate && deal.createdAt) {
      daysToComplete = Math.floor(
        (new Date(deal.closingDate).getTime() - new Date(deal.createdAt).getTime()) /
        (1000 * 60 * 60 * 24)
      );
    }

    const outcome = roiPercent >= 20 ? "success" : roiPercent >= 5 ? "partial_success" : "failure";

    const embedding = await this.generateEmbedding(fingerprint);

    const insertData: InsertDealPattern = {
      organizationId,
      dealId,
      fingerprint,
      outcome,
      profitAmount: profitAmount.toString(),
      roiPercent: roiPercent.toString(),
      daysToComplete,
      embeddingVector: embedding,
    };

    const [insertedPattern] = await db.insert(dealPatterns).values(insertData).returning();

    return insertedPattern;
  }

  async updateMatchOutcome(
    matchId: number,
    outcome: string,
    insightHelpful: boolean
  ): Promise<DealPatternMatch | null> {
    const [updated] = await db
      .update(dealPatternMatches)
      .set({
        actualOutcome: outcome,
        insightHelpful,
        insightsApplied: true,
      })
      .where(eq(dealPatternMatches.id, matchId))
      .returning();

    if (updated) {
      const pattern = await db
        .select()
        .from(dealPatterns)
        .where(eq(dealPatterns.id, updated.patternId))
        .limit(1);

      if (pattern[0]) {
        const currentMatches = pattern[0].timesMatched || 0;
        const currentSuccessRate = pattern[0].matchSuccessRate
          ? parseFloat(pattern[0].matchSuccessRate as string)
          : 0;

        const newMatches = currentMatches + 1;
        const successCount = currentSuccessRate * currentMatches + (insightHelpful ? 1 : 0);
        const newSuccessRate = successCount / newMatches;

        await db
          .update(dealPatterns)
          .set({
            timesMatched: newMatches,
            matchSuccessRate: newSuccessRate.toString(),
            updatedAt: new Date(),
          })
          .where(eq(dealPatterns.id, updated.patternId));
      }
    }

    return updated;
  }

  async getPatternPerformance(organizationId: number): Promise<PatternPerformanceResult> {
    const patterns = await db
      .select()
      .from(dealPatterns)
      .where(eq(dealPatterns.organizationId, organizationId));

    const totalPatterns = patterns.length;
    const successfulPatterns = patterns.filter((p) => p.outcome === "success").length;

    const avgRoi =
      patterns.length > 0
        ? patterns.reduce((sum, p) => sum + (p.roiPercent ? parseFloat(p.roiPercent as string) : 0), 0) /
          patterns.length
        : 0;

    const patternsByOutcome = {
      success: patterns.filter((p) => p.outcome === "success").length,
      partialSuccess: patterns.filter((p) => p.outcome === "partial_success").length,
      failure: patterns.filter((p) => p.outcome === "failure").length,
    };

    const topPerformingPatterns = patterns
      .filter((p) => p.timesMatched && p.timesMatched > 0)
      .map((p) => ({
        patternId: p.id,
        matchCount: p.timesMatched || 0,
        successRate: p.matchSuccessRate ? parseFloat(p.matchSuccessRate as string) : 0,
        avgProfit: p.profitAmount ? parseFloat(p.profitAmount as string) : 0,
      }))
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 10);

    return {
      totalPatterns,
      successfulPatterns,
      averageRoi: avgRoi,
      topPerformingPatterns,
      patternsByOutcome,
    };
  }

  async generateEmbedding(fingerprint: PatternFingerprint): Promise<number[] | null> {
    const openai = getOpenAIClient();
    if (!openai) {
      return this.generateSimpleEmbedding(fingerprint);
    }

    try {
      const text = this.fingerprintToText(fingerprint);

      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });

      return response.data[0]?.embedding || null;
    } catch (error) {
      console.error("Error generating embedding:", error);
      return this.generateSimpleEmbedding(fingerprint);
    }
  }

  private fingerprintToText(fingerprint: PatternFingerprint): string {
    const parts: string[] = [];

    parts.push(`Property: ${fingerprint.property.acreage} acres in ${fingerprint.property.county}, ${fingerprint.property.state}`);

    if (fingerprint.property.zoning) {
      parts.push(`Zoning: ${fingerprint.property.zoning}`);
    }
    if (fingerprint.property.terrain) {
      parts.push(`Terrain: ${fingerprint.property.terrain}`);
    }
    if (fingerprint.property.roadAccess) {
      parts.push(`Road Access: ${fingerprint.property.roadAccess}`);
    }
    if (fingerprint.property.utilities?.length) {
      parts.push(`Utilities: ${fingerprint.property.utilities.join(", ")}`);
    }

    parts.push(`Deal Type: ${fingerprint.deal.type}`);
    if (fingerprint.deal.offerToAskRatio) {
      parts.push(`Offer/Ask Ratio: ${(fingerprint.deal.offerToAskRatio * 100).toFixed(1)}%`);
    }
    if (fingerprint.deal.daysToClose) {
      parts.push(`Days to Close: ${fingerprint.deal.daysToClose}`);
    }
    if (fingerprint.deal.finalMargin) {
      parts.push(`Final Margin: ${fingerprint.deal.finalMargin.toFixed(1)}%`);
    }

    if (fingerprint.seller) {
      if (fingerprint.seller.type) {
        parts.push(`Seller Type: ${fingerprint.seller.type}`);
      }
      if (fingerprint.seller.motivation?.length) {
        parts.push(`Seller Motivation: ${fingerprint.seller.motivation.join(", ")}`);
      }
    }

    if (fingerprint.market) {
      parts.push(`Price Per Acre: $${fingerprint.market.pricePerAcre.toFixed(0)}`);
      if (fingerprint.market.marketTrend) {
        parts.push(`Market Trend: ${fingerprint.market.marketTrend}`);
      }
      if (fingerprint.market.competitionLevel) {
        parts.push(`Competition: ${fingerprint.market.competitionLevel}`);
      }
    }

    return parts.join(". ");
  }

  private generateSimpleEmbedding(fingerprint: PatternFingerprint): number[] {
    const features: number[] = [];

    features.push(Math.log1p(fingerprint.property.acreage) / 10);
    features.push(this.hashString(fingerprint.property.county) / 1000);
    features.push(this.hashString(fingerprint.property.state) / 100);
    features.push(fingerprint.property.zoning ? this.hashString(fingerprint.property.zoning) / 100 : 0);
    features.push(fingerprint.property.terrain ? this.hashString(fingerprint.property.terrain) / 100 : 0);
    features.push(fingerprint.property.roadAccess ? this.hashString(fingerprint.property.roadAccess) / 100 : 0);
    features.push(fingerprint.property.utilities?.length || 0);

    features.push(fingerprint.deal.type === "acquisition" ? 1 : 0);
    features.push(fingerprint.deal.offerToAskRatio || 0);
    features.push((fingerprint.deal.daysToClose || 0) / 365);
    features.push((fingerprint.deal.negotiationRounds || 0) / 10);
    features.push((fingerprint.deal.finalMargin || 0) / 100);

    if (fingerprint.seller) {
      features.push(fingerprint.seller.type ? this.hashString(fingerprint.seller.type) / 100 : 0);
      features.push(fingerprint.seller.motivation?.length || 0);
    } else {
      features.push(0, 0);
    }

    if (fingerprint.market) {
      features.push(Math.log1p(fingerprint.market.pricePerAcre) / 15);
      features.push(fingerprint.market.marketTrend ? this.hashString(fingerprint.market.marketTrend) / 100 : 0);
      features.push(fingerprint.market.competitionLevel ? this.hashString(fingerprint.market.competitionLevel) / 100 : 0);
    } else {
      features.push(0, 0, 0);
    }

    return features;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  async savePatternMatch(
    organizationId: number,
    targetPropertyId: number | null,
    targetDealId: number | null,
    patternMatch: PatternMatchResult,
    insights: DerivedInsights
  ): Promise<DealPatternMatch> {
    const insertData: InsertDealPatternMatch = {
      organizationId,
      targetPropertyId,
      targetDealId,
      patternId: patternMatch.pattern.id,
      similarityScore: patternMatch.similarityScore.toString(),
      matchedDimensions: patternMatch.matchedDimensions,
      insights,
    };

    const [inserted] = await db.insert(dealPatternMatches).values(insertData).returning();

    await db
      .update(dealPatterns)
      .set({
        timesMatched: (patternMatch.pattern.timesMatched || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(dealPatterns.id, patternMatch.pattern.id));

    return inserted;
  }

  setWeights(weights: Partial<SimilarityWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }
}

export const dealPatternCloningService = new DealPatternCloningService();
